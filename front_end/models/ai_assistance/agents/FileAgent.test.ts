// Copyright 2024 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Host from '../../../core/host/host.js';
import * as Platform from '../../../core/platform/platform.js';
import * as SDK from '../../../core/sdk/sdk.js';
import {createUISourceCode, mockAidaClient} from '../../../testing/AiAssistanceHelpers.js';
import {
  restoreUserAgentForTesting,
  setUserAgentForTesting,
  updateHostConfig,
} from '../../../testing/EnvironmentHelpers.js';
import {describeWithMockConnection} from '../../../testing/MockConnection.js';
import * as Bindings from '../../bindings/bindings.js';
import * as Workspace from '../../workspace/workspace.js';
import {FileAgent, FileContext, ResponseType} from '../ai_assistance.js';

describeWithMockConnection('FileAgent', () => {
  function mockHostConfig(modelId?: string, temperature?: number) {
    updateHostConfig({
      devToolsAiAssistanceFileAgent: {
        modelId,
        temperature,
      },
    });
  }

  beforeEach(() => {
    const workspace = Workspace.Workspace.WorkspaceImpl.instance();
    const targetManager = SDK.TargetManager.TargetManager.instance();
    const resourceMapping = new Bindings.ResourceMapping.ResourceMapping(targetManager, workspace);
    const ignoreListManager = Workspace.IgnoreListManager.IgnoreListManager.instance({forceNew: true});
    Bindings.DebuggerWorkspaceBinding.DebuggerWorkspaceBinding.instance({
      forceNew: true,
      resourceMapping,
      targetManager,
      ignoreListManager,
    });
  });

  describe('context provenance', () => {
    it('keeps synthetic, mapped and opaque files isolated while preserving each file identity', async () => {
      const file = await createUISourceCode();
      assert.exists(file);
      sinon.stub(file.project(), 'type').returns(Workspace.Workspace.projectTypes.Network);
      const context = new FileContext(file);
      const binding = Bindings.DebuggerWorkspaceBinding.DebuggerWorkspaceBinding.instance();
      const scripts = sinon.stub(binding, 'scriptsForUISourceCode');
      const script = sinon.createStubInstance(SDK.Script.Script);
      script.sourceURL = file.url();
      script.hasSourceURL = false;
      scripts.returns([script]);
      assert.strictEqual(context.getOrigin(), 'http://example.test');
      script.hasSourceURL = true;
      const opaque = context.getOrigin();
      assert.notStrictEqual(opaque, 'http://example.test');
      assert.strictEqual(new FileContext(file).getOrigin(), opaque);
      script.hasSourceURL = false;
      assert.strictEqual(context.getOrigin(), 'http://example.test');
      scripts.returns([]);
      assert.strictEqual(context.getOrigin(), opaque);
      scripts.throws(new Error('missing binding'));
      assert.strictEqual(context.getOrigin(), opaque);
      const other = await createUISourceCode({url: Platform.DevToolsPath.urlString`data:text/javascript,other`});
      assert.exists(other);
      assert.notStrictEqual(new FileContext(other).getOrigin(), opaque);
      assert.notStrictEqual(new FileContext(other).getOrigin(), 'null');
    });

    it('never trusts a source map or mismatched script origin', async () => {
      const file = await createUISourceCode();
      assert.exists(file);
      sinon.stub(file.project(), 'type').returns(Workspace.Workspace.projectTypes.Network);
      const context = new FileContext(file);
      const script = sinon.createStubInstance(SDK.Script.Script);
      script.sourceURL = 'https://attacker.test/script.js' as typeof script.sourceURL;
      script.hasSourceURL = false;
      sinon.stub(Bindings.DebuggerWorkspaceBinding.DebuggerWorkspaceBinding.instance(), 'scriptsForUISourceCode')
          .returns([script]);
      const opaque = context.getOrigin();
      assert.notStrictEqual(opaque, 'http://example.test');
      script.sourceURL = file.url();
      sinon.stub(file.contentType(), 'isFromSourceMap').returns(true);
      assert.strictEqual(context.getOrigin(), opaque);
    });
  });

  describe('buildRequest', () => {
    it('builds a request with a model id', async () => {
      mockHostConfig('test model');
      const agent = new FileAgent({
        aidaClient: {} as Host.AidaClient.AidaClient,
      });
      assert.strictEqual(
          agent.buildRequest({text: 'test input'}, Host.AidaClient.Role.USER).options?.model_id,
          'test model',
      );
    });

    it('builds a request with a temperature', async () => {
      mockHostConfig('test model', 1);
      const agent = new FileAgent({
        aidaClient: {} as Host.AidaClient.AidaClient,
      });
      assert.strictEqual(
          agent.buildRequest({text: 'test input'}, Host.AidaClient.Role.USER).options?.temperature,
          1,
      );
    });

    it('structure matches the snapshot', async () => {
      mockHostConfig('test model');
      sinon.stub(crypto, 'randomUUID').returns('sessionId' as `${string}-${string}-${string}-${string}-${string}`);
      const agent = new FileAgent({
        aidaClient: mockAidaClient([[{explanation: 'answer'}]]),
        serverSideLoggingEnabled: true,
      });
      await Array.fromAsync(agent.run('question', {selected: null}));

      setUserAgentForTesting();
      assert.deepEqual(
          agent.buildRequest({text: 'test input'}, Host.AidaClient.Role.USER),
          {
            current_message: {parts: [{text: 'test input'}], role: Host.AidaClient.Role.USER},
            client: 'CHROME_DEVTOOLS',
            preamble: undefined,
            historical_contexts: [
              {
                role: 1,
                parts: [{text: 'question'}],
              },
              {
                role: 2,
                parts: [{text: 'answer'}],
              },
            ],
            facts: undefined,
            metadata: {
              disable_user_content_logging: false,
              string_session_id: 'sessionId',
              user_tier: 2,
              client_version: 'unit_test',
            },
            options: {
              model_id: 'test model',
              temperature: undefined,
            },
            client_feature: 9,
            functionality_type: 1,
          },
      );
      restoreUserAgentForTesting();
    });
  });

  describe('run', () => {
    const testArguments = [
      {
        name: 'content loaded',
        requestContentData: true,
      },
      {
        name: 'content not loaded',
        requestContentData: false,
      },
    ];

    testArguments.forEach(args => {
      it('generates an answer ' + args.name, async () => {
        const agent = new FileAgent({
          aidaClient: mockAidaClient([[{
            explanation: 'This is the answer',
            metadata: {
              rpcGlobalId: 123,
            },
          }]]),
        });

        const uiSourceCode = await createUISourceCode({
          requestContentData: args.requestContentData,
          content: 'content',
        });
        const responses =
            await Array.fromAsync(agent.run('test', {selected: uiSourceCode ? new FileContext(uiSourceCode) : null}));

        assert.deepEqual(responses, [
          {
            type: ResponseType.USER_QUERY,
            query: 'test',
            imageInput: undefined,
            imageId: undefined,
          },
          {
            type: ResponseType.CONTEXT,
            title: 'Analyzing file',
            details: [
              {
                title: 'Selected file',
                text: `File name: script.js
URL: http://example.test/script.js
File content:
\`\`\`
content
\`\`\``,
              },
            ],
          },
          {
            type: ResponseType.QUERYING,
            //             query: `# Selected file
            // File name: script.js
            // URL: http://example.test/script.js
            // File content:
            // \`\`\`
            // content
            // \`\`\`

            // # User request

            // test`,
          },
          {
            type: ResponseType.ANSWER,
            text: 'This is the answer',
            complete: true,
            suggestions: undefined,
            rpcId: 123,
          },
        ]);

        assert.deepEqual(agent.buildRequest({text: ''}, Host.AidaClient.Role.USER).historical_contexts, [
          {
            role: 1,
            parts: [{
              text: `# Selected file
File name: script.js
URL: http://example.test/script.js
File content:
\`\`\`
content
\`\`\`

# User request

test`,
            }],
          },
          {
            role: 2,
            parts: [{text: 'This is the answer'}],
          },
        ]);
      });
    });
  });
});

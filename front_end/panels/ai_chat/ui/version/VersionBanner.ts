// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Lit from '../../../../ui/lit/lit.js';
import { CURRENT_VERSION } from '../../core/Version.js';

const {html, Decorators} = Lit;
const {customElement} = Decorators as any;

export interface VersionInfo { latestVersion: string; releaseUrl: string; isUpdateAvailable: boolean; }

@customElement('ai-version-banner')
export class VersionBanner extends HTMLElement {
  static readonly litTagName = Lit.StaticHtml.literal`ai-version-banner`;
  readonly #shadow = this.attachShadow({mode: 'open'});

  // Manual properties
  #info: VersionInfo | null = null;
  #dismissed = false;
  #nativeUpdater = false;

  get info(): VersionInfo | null { return this.#info; }
  set info(value: VersionInfo | null) { this.#info = value; this.#render(); }
  get dismissed(): boolean { return this.#dismissed; }
  set dismissed(value: boolean) { this.#dismissed = value; this.#render(); }
  get nativeUpdater(): boolean { return this.#nativeUpdater; }
  set nativeUpdater(value: boolean) { this.#nativeUpdater = value; this.#render(); }

  connectedCallback(): void { this.#render(); }

  #dismiss = () => { this.dispatchEvent(new CustomEvent('dismiss', {bubbles: true})); };

  #render(): void {
    if (this.#nativeUpdater) {
      Lit.render(html`
        <style>
          .native-updates { display: flex; align-items: center; justify-content: space-between;
            gap: 12px; padding: 8px 12px; margin: 8px 0; border-radius: 6px;
            background: var(--sys-color-surface-variant); color: var(--sys-color-on-surface); }
          button { border: none; background: transparent; color: var(--sys-color-primary);
            cursor: pointer; font: inherit; }
        </style>
        <div class="native-updates"><span>Browser Operator ${CURRENT_VERSION}</span>
          <button @click=${() => this.dispatchEvent(new CustomEvent('check-native-updates', {bubbles: true}))}>
            Check for updates
          </button>
        </div>
      `, this.#shadow, {host: this});
      return;
    }
    if (!this.#info || !this.#info.isUpdateAvailable || this.#dismissed) { Lit.render(Lit.nothing, this.#shadow, {host: this}); return; }
    const info = this.#info;
    Lit.render(html`
      <style>
        :host { position: relative; z-index: 9999; }
        .banner { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 6px; background: var(--sys-color-surface-variant); color: var(--sys-color-on-surface); margin: 8px 0; position: relative; z-index: 9999; }
        .link { color: var(--sys-color-primary); text-decoration: none; margin-left: 8px; }
        button.dismiss { border: none; background: transparent; color: var(--sys-color-on-surface); cursor: pointer; font-size: 14px; }
      </style>
      <div class="banner">
        <div>🎉 New version ${info.latestVersion} is available! <a class="link" href=${info.releaseUrl} target="_blank" rel="noopener noreferrer">View Release</a></div>
        <button class="dismiss" title="Dismiss" @click=${this.#dismiss}>✕</button>
      </div>
    `, this.#shadow, {host: this});
  }
}

declare global {
  interface HTMLElementTagNameMap { 'ai-version-banner': VersionBanner; }
}

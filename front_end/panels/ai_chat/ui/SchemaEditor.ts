// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Visual JSON Schema Editor for Agent Studio
 * Generates HTML/CSS/JS for editing agent input schemas
 */

export interface SchemaProperty {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  items?: { type: string }; // For array types
}

export interface SchemaEditorData {
  properties: SchemaProperty[];
}

/**
 * Convert SchemaEditorData to JSON Schema format
 */
export function schemaEditorDataToJSONSchema(data: SchemaEditorData): {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const prop of data.properties) {
    const propDef: Record<string, unknown> = {
      type: prop.type,
      description: prop.description,
    };

    if (prop.type === 'array' && prop.items) {
      propDef.items = prop.items;
    }

    properties[prop.name] = propDef;

    if (prop.required) {
      required.push(prop.name);
    }
  }

  const schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  } = {
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

/**
 * Convert JSON Schema to SchemaEditorData format
 */
export function jsonSchemaToEditorData(schema: {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
}): SchemaEditorData {
  const properties: SchemaProperty[] = [];
  const requiredFields = new Set(schema.required || []);

  for (const [name, propDef] of Object.entries(schema.properties || {})) {
    const def = propDef as Record<string, unknown>;
    const prop: SchemaProperty = {
      name,
      type: (def.type as SchemaProperty['type']) || 'string',
      description: (def.description as string) || '',
      required: requiredFields.has(name),
    };

    if (prop.type === 'array' && def.items) {
      prop.items = def.items as { type: string };
    }

    properties.push(prop);
  }

  return { properties };
}

/**
 * Generate CSS for the Schema Editor
 */
export function generateSchemaEditorCSS(): string {
  return `
    .schema-editor {
      border: 1px solid var(--sys-color-divider, #e0e0e0);
      border-radius: 8px;
      padding: 16px;
      background: var(--sys-color-surface, #fff);
    }

    .schema-editor-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .schema-editor-title {
      font-weight: 600;
      font-size: 14px;
      color: var(--sys-color-on-surface, #333);
    }

    .schema-add-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      background: var(--sys-color-primary, #00a4fe);
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.2s;
    }

    .schema-add-btn:hover {
      background: var(--sys-color-primary-hover, #0093e0);
    }

    .schema-properties-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .schema-property {
      display: grid;
      grid-template-columns: 1fr 120px 2fr auto auto;
      gap: 8px;
      align-items: center;
      padding: 12px;
      background: var(--sys-color-surface-variant, #f5f5f5);
      border-radius: 6px;
      border: 1px solid var(--sys-color-outline-variant, #e0e0e0);
    }

    .schema-property-input {
      padding: 8px 10px;
      border: 1px solid var(--sys-color-outline, #ccc);
      border-radius: 4px;
      font-size: 13px;
      background: var(--sys-color-surface, #fff);
      color: var(--sys-color-on-surface, #333);
    }

    .schema-property-input:focus {
      outline: none;
      border-color: var(--sys-color-primary, #00a4fe);
      box-shadow: 0 0 0 2px rgba(0, 164, 254, 0.2);
    }

    .schema-property-select {
      padding: 8px 10px;
      border: 1px solid var(--sys-color-outline, #ccc);
      border-radius: 4px;
      font-size: 13px;
      background: var(--sys-color-surface, #fff);
      color: var(--sys-color-on-surface, #333);
      cursor: pointer;
    }

    .schema-property-checkbox {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--sys-color-on-surface-variant, #666);
    }

    .schema-property-checkbox input {
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

    .schema-delete-btn {
      padding: 6px 8px;
      background: transparent;
      border: none;
      color: var(--sys-color-error, #dc3545);
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.2s;
    }

    .schema-delete-btn:hover {
      background: rgba(220, 53, 69, 0.1);
    }

    .schema-empty {
      text-align: center;
      padding: 24px;
      color: var(--sys-color-on-surface-variant, #666);
      font-size: 13px;
    }

    .schema-property-name {
      font-weight: 500;
    }

    @media (max-width: 800px) {
      .schema-property {
        grid-template-columns: 1fr;
        gap: 8px;
      }

      .schema-property-checkbox {
        justify-content: flex-start;
      }
    }
  `;
}

/**
 * Generate HTML for the Schema Editor
 */
export function generateSchemaEditorHTML(data: SchemaEditorData): string {
  const propertiesHTML = data.properties.length === 0
    ? '<div class="schema-empty">No properties defined. Click "Add Property" to create input fields for your agent.</div>'
    : data.properties.map((prop, index) => `
      <div class="schema-property" data-index="${index}">
        <input
          type="text"
          class="schema-property-input schema-property-name"
          value="${escapeHTML(prop.name)}"
          placeholder="Property name"
          data-field="name"
        />
        <select class="schema-property-select" data-field="type">
          <option value="string" ${prop.type === 'string' ? 'selected' : ''}>String</option>
          <option value="number" ${prop.type === 'number' ? 'selected' : ''}>Number</option>
          <option value="boolean" ${prop.type === 'boolean' ? 'selected' : ''}>Boolean</option>
          <option value="array" ${prop.type === 'array' ? 'selected' : ''}>Array</option>
          <option value="object" ${prop.type === 'object' ? 'selected' : ''}>Object</option>
        </select>
        <input
          type="text"
          class="schema-property-input"
          value="${escapeHTML(prop.description)}"
          placeholder="Description"
          data-field="description"
        />
        <label class="schema-property-checkbox">
          <input type="checkbox" data-field="required" ${prop.required ? 'checked' : ''} />
          Required
        </label>
        <button class="schema-delete-btn" data-action="delete" title="Delete property">
          🗑️
        </button>
      </div>
    `).join('');

  return `
    <div class="schema-editor" id="schema-editor">
      <div class="schema-editor-header">
        <span class="schema-editor-title">Input Schema</span>
        <button class="schema-add-btn" id="schema-add-property">
          <span>+</span> Add Property
        </button>
      </div>
      <div class="schema-properties-list" id="schema-properties-list">
        ${propertiesHTML}
      </div>
    </div>
  `;
}

/**
 * Generate JavaScript for the Schema Editor
 */
export function generateSchemaEditorJS(): string {
  return `
    // Schema Editor state
    window.schemaEditorData = window.schemaEditorData || { properties: [] };

    function initSchemaEditor() {
      const addBtn = document.getElementById('schema-add-property');
      const propertiesList = document.getElementById('schema-properties-list');

      if (addBtn) {
        addBtn.addEventListener('click', addProperty);
      }

      if (propertiesList) {
        propertiesList.addEventListener('click', handlePropertyAction);
        propertiesList.addEventListener('input', handlePropertyChange);
        propertiesList.addEventListener('change', handlePropertyChange);
      }
    }

    function addProperty() {
      const newProp = {
        name: 'new_property',
        type: 'string',
        description: '',
        required: false
      };

      window.schemaEditorData.properties.push(newProp);
      renderProperties();
      notifySchemaChange();
    }

    function handlePropertyAction(event) {
      const target = event.target;
      if (target.dataset.action === 'delete') {
        const propertyEl = target.closest('.schema-property');
        if (propertyEl) {
          const index = parseInt(propertyEl.dataset.index, 10);
          window.schemaEditorData.properties.splice(index, 1);
          renderProperties();
          notifySchemaChange();
        }
      }
    }

    function handlePropertyChange(event) {
      const target = event.target;
      const field = target.dataset.field;
      if (!field) return;

      const propertyEl = target.closest('.schema-property');
      if (!propertyEl) return;

      const index = parseInt(propertyEl.dataset.index, 10);
      const prop = window.schemaEditorData.properties[index];
      if (!prop) return;

      if (field === 'required') {
        prop.required = target.checked;
      } else if (field === 'name') {
        // Sanitize name: lowercase, underscores only
        prop.name = target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        target.value = prop.name;
      } else {
        prop[field] = target.value;
      }

      notifySchemaChange();
    }

    function renderProperties() {
      const propertiesList = document.getElementById('schema-properties-list');
      if (!propertiesList) return;

      if (window.schemaEditorData.properties.length === 0) {
        propertiesList.innerHTML = '<div class="schema-empty">No properties defined. Click "Add Property" to create input fields for your agent.</div>';
        return;
      }

      propertiesList.innerHTML = window.schemaEditorData.properties.map((prop, index) => \`
        <div class="schema-property" data-index="\${index}">
          <input
            type="text"
            class="schema-property-input schema-property-name"
            value="\${escapeHTMLJS(prop.name)}"
            placeholder="Property name"
            data-field="name"
          />
          <select class="schema-property-select" data-field="type">
            <option value="string" \${prop.type === 'string' ? 'selected' : ''}>String</option>
            <option value="number" \${prop.type === 'number' ? 'selected' : ''}>Number</option>
            <option value="boolean" \${prop.type === 'boolean' ? 'selected' : ''}>Boolean</option>
            <option value="array" \${prop.type === 'array' ? 'selected' : ''}>Array</option>
            <option value="object" \${prop.type === 'object' ? 'selected' : ''}>Object</option>
          </select>
          <input
            type="text"
            class="schema-property-input"
            value="\${escapeHTMLJS(prop.description)}"
            placeholder="Description"
            data-field="description"
          />
          <label class="schema-property-checkbox">
            <input type="checkbox" data-field="required" \${prop.required ? 'checked' : ''} />
            Required
          </label>
          <button class="schema-delete-btn" data-action="delete" title="Delete property">
            🗑️
          </button>
        </div>
      \`).join('');
    }

    function escapeHTMLJS(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    }

    function notifySchemaChange() {
      // Convert editor data to JSON schema format
      const schema = {
        type: 'object',
        properties: {},
        required: []
      };

      for (const prop of window.schemaEditorData.properties) {
        schema.properties[prop.name] = {
          type: prop.type,
          description: prop.description
        };
        if (prop.required) {
          schema.required.push(prop.name);
        }
      }

      if (schema.required.length === 0) {
        delete schema.required;
      }

      // Send to parent
      window.parent.postMessage({
        type: 'schema-change',
        schema: schema
      }, '*');
    }

    function setSchemaEditorData(data) {
      window.schemaEditorData = data;
      renderProperties();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initSchemaEditor);
    } else {
      initSchemaEditor();
    }
  `;
}

/**
 * Helper to escape HTML
 */
function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/**
 * Create default schema with query and reasoning fields
 */
export function createDefaultSchema(): SchemaEditorData {
  return {
    properties: [
      {
        name: 'query',
        type: 'string',
        description: 'The user query or task to execute',
        required: true,
      },
      {
        name: 'reasoning',
        type: 'string',
        description: 'Reasoning for why this agent was invoked',
        required: true,
      },
    ],
  };
}

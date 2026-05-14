export type ConfigFieldType = 'text' | 'password' | 'select' | 'textarea' | 'json' | 'key-value';

export interface ConfigField {
  name: string;
  type: ConfigFieldType;
  label: string;
  required?: boolean;
  hint?: string;
  options?: string[];
  placeholder?: string;
}

export interface ProviderSchema {
  id: string;
  name: string;
  type: 'managed' | 'generic';
  schemaVersion: number;
  fields: ConfigField[];
}

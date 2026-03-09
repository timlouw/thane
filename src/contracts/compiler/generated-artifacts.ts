export interface GeneratedStaticTemplatePart {
  id: string;
  html: string;
}

export interface GeneratedInitBindingsArtifact {
  code: string;
  staticTemplates?: string[];
}

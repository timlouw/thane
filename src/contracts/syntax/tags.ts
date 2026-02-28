export const TEMPLATE_TAG = {
  HTML: 'html',
  CSS: 'css',
} as const;

export type TemplateTagName = (typeof TEMPLATE_TAG)[keyof typeof TEMPLATE_TAG];

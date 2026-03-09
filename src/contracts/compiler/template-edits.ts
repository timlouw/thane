export const TEMPLATE_EDIT_KIND = {
  REMOVE: 'remove',
  REPLACE: 'replace',
  INSERT_ID: 'insertId',
} as const;

export type TemplateEditKind = (typeof TEMPLATE_EDIT_KIND)[keyof typeof TEMPLATE_EDIT_KIND];

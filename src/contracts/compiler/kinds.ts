export const PARSER_STATE = {
  TEXT: 'TEXT',
  TAG_OPEN: 'TAG_OPEN',
  TAG_NAME: 'TAG_NAME',
  TAG_SPACE: 'TAG_SPACE',
  ATTR_NAME: 'ATTR_NAME',
  ATTR_EQ: 'ATTR_EQ',
  ATTR_VALUE_Q: 'ATTR_VALUE_Q',
  ATTR_VALUE_UQ: 'ATTR_VALUE_UQ',
  TAG_CLOSE: 'TAG_CLOSE',
  COMMENT: 'COMMENT',
} as const;

export type ParserStateKind = (typeof PARSER_STATE)[keyof typeof PARSER_STATE];

export const PARSER_BINDING_KIND = {
  TEXT: 'text',
  STYLE: 'style',
  ATTR: 'attr',
  WHEN: 'when',
  WHEN_ELSE: 'whenElse',
  REPEAT: 'repeat',
  EVENT: 'event',
} as const;

export type ParserBindingKind = (typeof PARSER_BINDING_KIND)[keyof typeof PARSER_BINDING_KIND];

export const REACTIVE_BINDING_KIND = {
  TEXT: 'text',
  STYLE: 'style',
  ATTR: 'attr',
} as const;

export type ReactiveBindingKind = (typeof REACTIVE_BINDING_KIND)[keyof typeof REACTIVE_BINDING_KIND];

export const TEXT_BINDING_MODE = {
  /** Sole content of its element: the row creates the Text node on fill and writes its nodeValue after */
  TEXT_NODE: 'textNode',
  /** Mixed content: located through a `<!--id-->` comment marker, writes the following Text node */
  COMMENT_MARKER: 'commentMarker',
} as const;

export type TextBindingMode = (typeof TEXT_BINDING_MODE)[keyof typeof TEXT_BINDING_MODE];

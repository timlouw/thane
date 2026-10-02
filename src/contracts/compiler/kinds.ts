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

export type ParserBindingKind = 'text' | 'style' | 'attr' | 'when' | 'whenElse' | 'repeat' | 'event' | 'ref';

export type ReactiveBindingKind = 'text' | 'style' | 'attr';

export type TextBindingMode =
  /** Sole content of its element: the row creates the Text node on fill and writes its nodeValue after */
  | 'textNode'
  /** Mixed content: located through a `<!--id-->` comment marker, writes the following Text node */
  | 'commentMarker';

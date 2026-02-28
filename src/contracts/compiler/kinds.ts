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
  TEXT_CONTENT: 'textContent',
  COMMENT_MARKER: 'commentMarker',
} as const;

export type TextBindingMode = (typeof TEXT_BINDING_MODE)[keyof typeof TEXT_BINDING_MODE];

export const REPEAT_OPTIMIZATION_SKIP_REASON = {
  NO_BINDINGS: 'no-bindings',
  SIGNAL_BINDINGS: 'signal-bindings',
  NESTED_REPEAT: 'nested-repeat',
  NESTED_CONDITIONAL: 'nested-conditional',
  MIXED_BINDINGS: 'mixed-bindings',
  MULTI_ROOT: 'multi-root',
  PATH_NOT_FOUND: 'path-not-found',
} as const;

export type RepeatOptimizationSkipReasonKind =
  (typeof REPEAT_OPTIMIZATION_SKIP_REASON)[keyof typeof REPEAT_OPTIMIZATION_SKIP_REASON];

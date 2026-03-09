export const DIRECTIVE_FN = {
  WHEN: 'when',
  WHEN_ELSE: 'whenElse',
  REPEAT: 'repeat',
} as const;

export type DirectiveName = (typeof DIRECTIVE_FN)[keyof typeof DIRECTIVE_FN];

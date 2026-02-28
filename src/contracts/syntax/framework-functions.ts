export const FRAMEWORK_FN = {
  DEFINE_COMPONENT: 'defineComponent',
  SIGNAL: 'signal',
  WHEN: 'when',
  WHEN_ELSE: 'whenElse',
  REPEAT: 'repeat',
  HTML: 'html',
  CSS: 'css',
} as const;

export type FrameworkFunctionName = (typeof FRAMEWORK_FN)[keyof typeof FRAMEWORK_FN];

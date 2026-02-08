export const shouldSkipPath = (filePath: string): boolean => {
  return filePath.includes('node_modules') || filePath.includes('scripts') || filePath.endsWith('.d.ts');
};

export const hasSignalPatterns = (source: string): boolean => {
  return source.includes('this.') && source.includes('()') && source.includes('signal(');
};

export const extendsComponentQuick = (source: string): boolean => {
  return source.includes('extends Component');
};

export const createLoaderResult = (contents: string): { contents: string; loader: 'ts' } => ({
  contents,
  loader: 'ts',
});

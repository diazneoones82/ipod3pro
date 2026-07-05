// Design tokens from design_guidelines.json
export const COLORS = {
  surface: '#05050A',
  onSurface: '#EDEDF0',
  surfaceSecondary: '#12121A',
  onSurfaceSecondary: '#A0A0AB',
  surfaceTertiary: '#1E1E26',
  onSurfaceTertiary: '#7A7A85',
  surfaceInverse: '#F5F5F7',
  onSurfaceInverse: '#05050A',
  brand: '#F59E0B',
  brandPrimary: '#F59E0B',
  onBrandPrimary: '#05050A',
  brandSecondary: '#D97706',
  brandTertiary: '#452A05',
  onBrandTertiary: '#FDE68A',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#E11D48',
  border: '#2A2A35',
  borderStrong: '#404050',
  divider: '#1E1E26',
  // Chrome ring gradient stops
  chromeLight: '#D4D4DC',
  chromeMid: '#8A8A95',
  chromeDark: '#2A2A35',
  chromeShine: '#F5F5F7',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
};

export const RADIUS = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};

export const FONT = {
  display: 'System', // Fraunces would require expo-font load; fallback to system serif feel via weight
  text: 'System',
};

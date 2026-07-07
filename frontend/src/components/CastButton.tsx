import React from 'react';
import { Platform, requireNativeComponent } from 'react-native';

const NativeCastButton = Platform.OS === 'android'
  ? requireNativeComponent('CastButton')
  : () => null;

type Props = {
  style?: any;
};

export default function CastButton({ style }: Props) {
  if (Platform.OS !== 'android') return null;
  return <NativeCastButton style={{ width: 48, height: 48, ...style }} />;
}

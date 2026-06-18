const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

const webrtcRoot = path.resolve(__dirname, '../../');
const rnMacosPath = path.resolve(__dirname, 'node_modules/react-native-macos');

const config = {
  watchFolders: [webrtcRoot],
  resolver: {
    extraNodeModules: {
      'react-native': rnMacosPath,
      react: path.resolve(__dirname, 'node_modules/react'),
    },
    platforms: ['macos', 'ios', 'android'],
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

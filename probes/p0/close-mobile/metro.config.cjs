const path = require('node:path')
const fs = require('node:fs')
const { getDefaultConfig } = require('expo/metro-config')
const baseline = process.env.HERMES_BASELINE || '/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline'
const shared = path.join(baseline, 'apps/shared/src')
const deps = path.join(process.env.HERMES_EXPO_DEPS || '/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/close-mobile', 'node_modules')
if (!fs.existsSync(shared) || !fs.existsSync(deps)) throw new Error('Missing pinned baseline or scoped dependencies; see README.md')
const config = getDefaultConfig(__dirname)
config.watchFolders = [shared, deps]
config.resolver.nodeModulesPaths = [deps]
// Keep nested Expo dependencies visible; npm may nest expo-asset under expo/node_modules.
config.resolver.disableHierarchicalLookup = false
config.resolver.resolveRequest = (context, name, platform) => {
  if (name === '@hermes-sdk/json-rpc-channel' || name === '@hermes-sdk/json-rpc-gateway') {
    return { type: 'sourceFile', filePath: path.join(shared, name.split('/')[1] + '.ts') }
  }
  // The upstream TS ESM sources use .js specifiers for tsc output. Resolve to TS for Metro.
  if (context.originModulePath.startsWith(shared + path.sep) && name.startsWith('./') && name.endsWith('.js')) {
    const source = path.resolve(path.dirname(context.originModulePath), name.slice(0, -3) + '.ts')
    if (fs.existsSync(source) && source.startsWith(shared + path.sep)) {
      return { type: 'sourceFile', filePath: source }
    }
  }
  return context.resolveRequest(context, name, platform)
}
module.exports = config

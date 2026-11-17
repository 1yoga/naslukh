const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const projectRoot = __dirname
const speechRn = path.resolve(projectRoot, "../../packages/speech-rn")

const config = getDefaultConfig(projectRoot)
config.watchFolders = [...(config.watchFolders ?? []), speechRn]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")]
config.resolver.disableHierarchicalLookup = true

module.exports = config

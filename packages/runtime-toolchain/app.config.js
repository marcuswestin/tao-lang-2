const { createExpoAppConfig } = require('./app-config.cjs')

module.exports = ({ config }) => createExpoAppConfig(config, __dirname)

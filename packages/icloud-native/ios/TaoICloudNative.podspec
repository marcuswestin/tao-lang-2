require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TaoICloudNative'
  s.version        = package['version']
  s.summary        = 'iCloud Drive documents for Tao datasources'
  s.description    = 'Coordinated reads, writes, conflict resolution, and change events for the named documents Tao datasource providers keep in the app\'s iCloud container.'
  s.author         = 'Tao'
  s.homepage       = 'https://tao-lang.org'
  s.license        = { :type => 'Private' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end

Pod::Spec.new do |s|
  s.name           = 'TaoRuntimeNative'
  # This local unpublished runtime has no JS release version to inherit.
  s.version        = '0.0.0'
  s.summary        = 'Native continuous clock for Tao runtime timers'
  s.description    = 'Provides a sleep-inclusive monotonic clock to Tao runtime timers.'
  s.author         = 'Tao'
  s.homepage       = 'https://devtao.com'
  s.license        = { :type => 'AGPL-3.0-only' }
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

package tao.runtime

import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TaoContinuousClockModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TaoContinuousClock")

    Function("nowMilliseconds") {
      SystemClock.elapsedRealtimeNanos().toDouble() / NANOS_PER_MILLISECOND
    }
  }

  private companion object {
    const val NANOS_PER_MILLISECOND = 1_000_000.0
  }
}

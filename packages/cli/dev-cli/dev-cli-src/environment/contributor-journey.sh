# Sourced by the Linux and macOS contributor guests, which each define their own timed `step label cmd...`.
# The dev loop and make-a-change half of the contributor journey, in one order for both:
# start the loop on a starter, edit the compiler, restart the loop, and see the edit served.
# A loop left running would outlive its guest step, so the last step always stops it.
contributor_journey() {
  journey=packages/cli/dev-cli/dev-cli-src/environment/contributor-journey-step.sh
  journey_result=0
  step dev-loop-start /bin/sh "$journey" loop-start \
    && step dev-loop-serve /bin/sh "$journey" loop-serve \
    && step toolchain-change /bin/sh "$journey" toolchain-change \
    && step dev-loop-restart /bin/sh "$journey" loop-restart \
    && step dev-loop-reflect /bin/sh "$journey" loop-reflect \
    || journey_result=1
  step dev-loop-stop /bin/sh "$journey" loop-stop || journey_result=1
  return "$journey_result"
}

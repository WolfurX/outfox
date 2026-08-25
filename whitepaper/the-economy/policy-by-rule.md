# Running money by rule

The usual GameFi heuristic is "keep sinks bigger than faucets." Too crude to steer with. Outfox manages the economy as a macro system, on the quantity theory of money:

**M · V = P · Q** — money supply, velocity, price level, real output.

Stable prices mean money growth roughly tracks output growth. All four quantities are instrumented in the model, and the specification requires the same instruments live in production as acceptance criteria. They are not running yet, because nothing is live. The design is grounded in Lehdonvirta & Castronova, *Virtual Economies: Design and Analysis* (MIT Press, 2014). Real economic theory, not GameFi folklore.

## Rule, not mood

The operating intent is a central bank plus treasury with **pre-committed, published rules** rather than discretion, because discretion invites manipulation and destroys trust. Every lever is a parameter with a validated band; moves within the band follow a stated rule; a move outside the band requires a fresh validation run first.

Not yet done, and worth saying: no rules or parameter values have been published, and the simulation's constants are explicitly not production values. Publishing them is a launch commitment, not an accomplishment.

## The whale problem, and how the model solved it

Wealth concentration is where designed economies quietly fail. Ours did too, at first.

Under a scenario where only the wealthy buy the token, the model showed a genuinely oligarchic distribution: a Pareto tail index around 1.0 against a bar of 2.0. The median was policy-controllable; the tail was not. The diagnosis, which took an adversarial review to get right, was not compounding wealth. Every drain on the token touched only liquid holdings while staked positions sat perfectly sheltered, and wealthy buyers had 12 to 50 times everyone else's token inflow. Those two facts put different players' wealth plateaus 4 to 7 times apart, and the tail index was reading that gap.

Two mechanisms fixed it, and neither works alone **\[both designed, validated in simulation]**:

1. **A progressive carry on the total position.** Holdings above a published shelter pay a daily carry whether liquid or staked. Locking still beats idling at every size, so the anti-dump property survives; the shelter is simply bounded.
2. **Wealth-indexed primary issuance.** Buying $ALPHA from the game costs more the more you already hold. It compresses the inflow gap at its source.

Result: tail index 1.0 → 2.80, inside a wide passing region rather than on a knife-edge.

Two named residuals on that result, because they are real: the fix is measured **per identity**, so split-identity evasion weakens it (identity integrity is the load-bearing assumption); and the passing window partly reflects the whale population share the model assumes, so the launch plan includes instrumenting the actual payer mix rather than trusting the assumption.

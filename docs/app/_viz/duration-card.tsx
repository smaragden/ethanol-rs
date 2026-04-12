"use client";

import { useState } from "react";
import { FeatureCard } from "./feature-card";
import { DurationSliderViz } from "./duration-slider";

export function DurationCard() {
  const [durationMin, setDurationMin] = useState(30);

  const durationLabel =
    durationMin === 0 ? "instant (shot)" : `sipped over ${durationMin} min`;

  const code = `import { generateCurve } from "ethanol-rs";

const profile = {
  weight_kg: 75,
  biological_sex: "male",
  height_cm: 178,
  age: 32,
};

const drink = {
  volume_ml: 500,
  abv: 0.05,
  offset_secs: 0,
  duration_secs: \u00ab${durationMin * 60}\u00bb,  // ${durationLabel}
  stomach_state: "some_food",
};

const curve = generateCurve(
  [drink], profile, "watson",
  0, 4 * 3600, 60, 0.06, 0.09
);`;

  return (
    <FeatureCard
      title="Drink duration flattens the peak"
      description={
        <>
          <code>duration_secs</code> treats a drink as a constant-rate infusion.
          Shot it and you get a tall spike. Sip the same thing over an hour and
          the peak drops by 30–40%, with a longer tail to match.
        </>
      }
      viz={
        <DurationSliderViz
          durationMin={durationMin}
          onDurationChange={setDurationMin}
        />
      }
      code={code}
    />
  );
}

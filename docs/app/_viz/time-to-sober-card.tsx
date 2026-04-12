"use client";

import { useState } from "react";
import { FeatureCard } from "./feature-card";
import { TimeToSoberViz } from "./time-to-sober";

export function TimeToSoberCard() {
  const [numBeers, setNumBeers] = useState(3);

  const drinksCode = Array.from({ length: numBeers }, (_, i) => {
    const offset = -(numBeers - i) * 1800;
    return `  { volume_ml: 330, abv: 0.05, offset_secs: \u00ab${offset}\u00bb, stomach_state: "some_food" },`;
  }).join("\n");

  const code = `import { calculateBAC, minutesUntilSober } from "ethanol-rs";

const profile = {
  weight_kg: 75,
  biological_sex: "male",
  height_cm: 178,
  age: 32,
};

// \u00ab${numBeers}\u00bb beer${numBeers === 1 ? "" : "s"}, 30 min apart
const drinks = [
${drinksCode || "  // no drinks yet"}
];

const bac  = calculateBAC(drinks, profile, "watson");
const mins = minutesUntilSober(drinks, profile, "watson");`;

  return (
    <FeatureCard
      title="Time to sober"
      description="Given your current drinks, the crate finds the minute at which BAC returns to zero. It accounts for drinks still being absorbed, so it's more honest than just current BAC divided by the metabolism rate."
      viz={
        <TimeToSoberViz
          numBeers={numBeers}
          onNumBeersChange={setNumBeers}
        />
      }
      code={code}
    />
  );
}

import { Simulator } from "./simulator/components/simulator";
import { FeatureCard } from "./_viz/feature-card";
import { FormulaCompareViz } from "./_viz/formula-compare";
import { DurationCard } from "./_viz/duration-card";
import { SessionDetectionViz } from "./_viz/session-detection";
import { WeightSensitivityViz } from "./_viz/weight-sensitivity";
import { SexCompareViz } from "./_viz/sex-compare";
import { StomachStateViz } from "./_viz/stomach-state";
import { TimeToSoberCard } from "./_viz/time-to-sober-card";

const GITHUB_URL = "https://github.com/smaragden/ethanol-rs";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-20 px-5 py-16 sm:py-24">
      {/* Hero */}
      <header className="flex flex-col items-center gap-5 text-center">
        <span className="rounded-full border border-outline-variant/20 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-on-surface-variant/60">
          ethanol-rs · v0.1
        </span>
        <h1 className="font-display text-5xl font-bold leading-tight text-on-surface sm:text-6xl">
          Pharmacokinetic BAC
          <br />
          <span className="text-primary">in your browser.</span>
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-on-surface-variant/80 sm:text-lg">
          A small Rust crate for modelling blood alcohol concentration. It
          knows Widmark and Watson, first-order absorption, how to tell two
          drinking sessions apart, and when you&rsquo;re sober again. Every
          chart on this page is the crate itself, compiled to WebAssembly and
          running locally in your tab.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <a
            href={GITHUB_URL}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-highest/40 px-4 text-sm font-medium text-on-surface transition-colors hover:bg-surface-bright/60"
          >
            GitHub
          </a>
          <a
            href="#simulator"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary/15 px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/25"
          >
            Skip ahead to the sandbox
          </a>
        </div>
      </header>

      {/* Feature viz */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-semibold text-on-surface sm:text-3xl">
            A tour of the features
          </h2>
          <p className="text-sm text-on-surface-variant/70">
            Every chart below is one library call drawn onto a canvas. Nothing
            fancy.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <FeatureCard
            title="Widmark vs Watson"
            description="Same drinks, same profile, two different formulas. Widmark is the classic one (body weight and a sex-based constant). Watson tries to estimate total body water from weight, height and age. For most people they agree closely; at the extremes they start to bicker."
            viz={<FormulaCompareViz />}
            code={`import { generateCurve } from "ethanol-rs";

const profile = {
  weight_kg: 75,
  biological_sex: "male",
  height_cm: 178,
  age: 32,
};

const drinks = [
  { volume_ml: 330, abv: 0.05, offset_secs: 0,    stomach_state: "some_food" },
  { volume_ml: 330, abv: 0.05, offset_secs: 1800, stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 3600, stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 5400, stomach_state: "some_food" },
];

const widmark = generateCurve(
  drinks, profile, "widmark",
  0, 6 * 3600, 60, 0.06, 0.09
);
const watson = generateCurve(
  drinks, profile, "watson",
  0, 6 * 3600, 60, 0.06, 0.09
);`}
          />

          <DurationCard />

          <FeatureCard
            title="Session detection"
            description="If the BAC from an earlier drinking bout has fully metabolised before your next drink, the crate calls that a new session and restarts the clock. No ghost alcohol carried over from brunch. Query the current BAC and you only see the session you're actually in."
            viz={<SessionDetectionViz />}
            code={`import { generateCurve } from "ethanol-rs";

const profile = {
  weight_kg: 75,
  biological_sex: "male",
  height_cm: 178,
  age: 32,
};

const session1 = [
  { volume_ml: 330, abv: 0.05, offset_secs: 0,    stomach_state: "some_food" },
  { volume_ml: 330, abv: 0.05, offset_secs: 1800, stomach_state: "some_food" },
];

const session2 = [
  { volume_ml: 330, abv: 0.05, offset_secs: 32400, stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 36000, stomach_state: "some_food" },
  { volume_ml: 330, abv: 0.05, offset_secs: 37800, stomach_state: "some_food" },
];

// Each session is evaluated independently — generateCurve drops
// past sessions, so call once per window and stitch together.
const s1 = generateCurve(
  session1, profile, "watson",
  0, 7 * 3600, 120, 0.06, 0.09
);
const s2 = generateCurve(
  session2, profile, "watson",
  7 * 3600, 13 * 3600, 120, 0.06, 0.09
);`}
          />

          <FeatureCard
            title="Body weight sensitivity"
            description="The same three drinks, served to a 55, 75 and 95 kg drinker. Less body water means a bigger dose per kilo, so the lightest curve peaks around 1.7× as high as the heaviest one. Physics doesn't play favourites."
            viz={<WeightSensitivityViz />}
            code={`import { generateCurve } from "ethanol-rs";

const drinks = [
  { volume_ml: 330, abv: 0.05, offset_secs: 0,    stomach_state: "some_food" },
  { volume_ml: 330, abv: 0.05, offset_secs: 1800, stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 3600, stomach_state: "some_food" },
];

const weights = [55, 75, 95];

const curves = weights.map((w) =>
  generateCurve(
    drinks,
    { weight_kg: w, biological_sex: "male", height_cm: 178, age: 32 },
    "watson",
    0, 6 * 3600, 60, 0.06, 0.09
  )
);`}
          />

          <FeatureCard
            title="Biological sex"
            description="Watson gives women a lower total body water fraction for the same weight, so the same dose of ethanol concentrates more. At identical weight, height and age a woman's BAC peaks noticeably higher than a man's."
            viz={<SexCompareViz />}
            code={`import { generateCurve } from "ethanol-rs";

const drinks = [
  { volume_ml: 330, abv: 0.05, offset_secs: 0,    stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 2700, stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 5400, stomach_state: "some_food" },
];

const male   = { weight_kg: 75, biological_sex: "male",   height_cm: 178, age: 32 };
const female = { weight_kg: 75, biological_sex: "female", height_cm: 178, age: 32 };

const mCurve = generateCurve(
  drinks, male, "watson",
  0, 6 * 3600, 60, 0.06, 0.09
);
const fCurve = generateCurve(
  drinks, female, "watson",
  0, 6 * 3600, 60, 0.06, 0.09
);`}
          />

          <FeatureCard
            title="Stomach state"
            description="Food slows gastric emptying, and with it absorption. The crate buckets this into three states (empty, some_food, full). More food in the stomach, lower and later peak. Mum was right about eating before going out."
            viz={<StomachStateViz />}
            code={`import { generateCurve } from "ethanol-rs";

const profile = {
  weight_kg: 75,
  biological_sex: "male",
  height_cm: 178,
  age: 32,
};

const states = ["empty", "some_food", "full"] as const;

const curves = states.map((stomach_state) =>
  generateCurve(
    [{ volume_ml: 500, abv: 0.06, offset_secs: 0, stomach_state }],
    profile,
    "watson",
    0, 4 * 3600, 60, 0.06, 0.09
  )
);`}
          />

          <TimeToSoberCard />
        </div>
      </section>

      {/* Live simulator — the capstone, after you've seen each piece */}
      <section id="simulator" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-semibold text-on-surface sm:text-3xl">
            Now try it yourself
          </h2>
          <p className="text-sm text-on-surface-variant/70">
            Everything from the tour above, stitched together in one sandbox.
            Add drinks, scrub through time, flip between male and female, drag
            the pace slider around. Same WASM crate as the charts, no server
            talking back.
          </p>
        </div>
        <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-low/40 p-5 backdrop-blur-xl sm:p-8">
          <Simulator />
        </div>
      </section>

      {/* Disclaimer */}
      <section className="rounded-2xl border border-outline-variant/15 bg-surface-container-low/30 px-6 py-5 text-sm leading-relaxed text-on-surface-variant/70">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-on-surface-variant/50">
          Disclaimer
        </h2>
        <p className="font-medium text-on-surface-variant/90">
          For educational and research purposes only.
        </p>
        <p className="mt-2">
          This library provides <em>estimates</em> based on
          population-average pharmacokinetic models. Individual responses to
          alcohol vary significantly due to genetic polymorphisms in ADH/ALDH,
          liver health, chronic tolerance, medication interactions, and
          hydration status.
        </p>
        <p className="mt-2">
          <strong className="text-on-surface-variant/90">
            Do not use
          </strong>{" "}
          to determine fitness to drive, operate machinery, or make any
          safety-critical decision. BAC estimates are not a substitute for
          breathalyser or blood testing, clinical judgement, or following local
          laws regarding alcohol consumption.
        </p>
        <p className="mt-2 font-medium text-on-surface-variant/90">
          When in doubt, don&rsquo;t drive.
        </p>
      </section>

      {/* Footer */}
      <footer className="flex flex-col items-center gap-2 border-t border-outline-variant/10 pt-10 text-xs text-on-surface-variant/50">
        <p>
          ethanol-rs is a Rust library, dual-licensed MIT / Apache-2.0. The
          same crate powers the iOS, Android and web builds.
        </p>
      </footer>
    </main>
  );
}

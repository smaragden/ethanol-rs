"use client";

import type { SimAction, SimDrink } from "../lib/types";

const PRESETS: Pick<SimDrink, "name" | "volumeMl" | "abv">[] = [
  { name: "Beer", volumeMl: 330, abv: 0.05 },
  { name: "Wine", volumeMl: 150, abv: 0.12 },
  { name: "Shot", volumeMl: 40, abv: 0.4 },
  { name: "Cocktail", volumeMl: 200, abv: 0.15 },
];

const EMOJI: Record<string, string> = {
  Beer: "\uD83C\uDF7A",
  Wine: "\uD83C\uDF77",
  Shot: "\uD83E\uDD43",
  Cocktail: "\uD83C\uDF78",
};

interface DrinkButtonsProps {
  dispatch: React.Dispatch<SimAction>;
}

export function DrinkButtons({ dispatch }: DrinkButtonsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-center sm:gap-3">
      {PRESETS.map((drink) => (
        <button
          key={drink.name}
          onClick={() => dispatch({ type: "ADD_DRINK", drink })}
          className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-highest/40 px-3 text-sm font-medium text-on-surface-variant backdrop-blur-xl transition-all hover:bg-surface-bright/60 active:scale-95 sm:px-5"
        >
          <span>{EMOJI[drink.name]}</span>
          <span>{drink.name}</span>
          <span className="hidden text-xs text-on-surface-variant/50 sm:inline">
            {drink.volumeMl}ml / {Math.round(drink.abv * 100)}%
          </span>
        </button>
      ))}
    </div>
  );
}

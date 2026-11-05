import { ROUND_MINUTE_OPTIONS } from "../shared";

type Props = {
  minutes: number;
  // Without a handler the picker only shows the chosen time, for guests who cannot change it.
  onChange?: (minutes: number) => void;
};

export function RoundTimePicker({ minutes, onChange }: Props) {
  if (!onChange) {
    return <p className="round-time-note">Each round lasts up to {minutes} minutes.</p>;
  }

  return (
    <fieldset className="round-time">
      <legend>Time per round</legend>
      <div>
        {ROUND_MINUTE_OPTIONS.map((option) => (
          <button aria-pressed={option === minutes} key={option} onClick={() => onChange(option)} type="button">
            {option} min
          </button>
        ))}
      </div>
      <small>Wizards who run out of time keep their Mados, stay hidden and flee if attacked.</small>
    </fieldset>
  );
}

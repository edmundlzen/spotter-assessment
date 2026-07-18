import { useState } from "react"

const SAMPLE = {
  current_location: "New York, NY",
  pickup_location: "Chicago, IL",
  dropoff_location: "Dallas, TX",
  cycle_hours_used: "0",
}

const EMPTY = {
  current_location: "",
  pickup_location: "",
  dropoff_location: "",
  cycle_hours_used: "0",
}

const FIELDS = [
  {
    name: "current_location",
    label: "Current location",
    placeholder: "City, state or street address",
    marker: "A",
  },
  {
    name: "pickup_location",
    label: "Pickup location",
    placeholder: "Where are you collecting the load?",
    marker: "B",
  },
  {
    name: "dropoff_location",
    label: "Drop-off location",
    placeholder: "Final delivery location",
    marker: "C",
  },
]

function validate(values) {
  const errors = {}
  for (const field of FIELDS) {
    const value = values[field.name].trim()
    if (!value) errors[field.name] = `${field.label} is required.`
    else if (value.length > 200) {
      errors[field.name] = "Use 200 characters or fewer."
    }
  }

  const cycle = Number(values.cycle_hours_used)
  if (
    values.cycle_hours_used === "" ||
    !Number.isFinite(cycle) ||
    cycle < 0 ||
    cycle > 70
  ) {
    errors.cycle_hours_used = "Enter a number from 0 to 70."
  }
  return errors
}

export default function TripForm({
  busy,
  error,
  fieldErrors = {},
  initialValues = EMPTY,
  loadingMessage,
  onSubmit,
}) {
  const [values, setValues] = useState(() => ({
    ...EMPTY,
    ...initialValues,
    cycle_hours_used: String(
      initialValues.cycle_hours_used ?? EMPTY.cycle_hours_used,
    ),
  }))
  const [localErrors, setLocalErrors] = useState({})
  const errors = { ...fieldErrors, ...localErrors }

  function update(name, value) {
    setValues((current) => ({ ...current, [name]: value }))
    setLocalErrors((current) => ({ ...current, [name]: undefined }))
  }

  function submit(event) {
    event.preventDefault()
    const nextErrors = validate(values)
    setLocalErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    onSubmit({
      current_location: values.current_location.trim(),
      pickup_location: values.pickup_location.trim(),
      dropoff_location: values.dropoff_location.trim(),
      cycle_hours_used: Number(values.cycle_hours_used),
    })
  }

  return (
    <section className="planner-card" aria-labelledby="planner-title">
      <div className="planner-card__header">
        <div>
          <p className="eyebrow">Plan an HOS-aware trip</p>
          <h1 id="planner-title">Where are you headed?</h1>
          <p>
            Enter your route and current 70-hour cycle usage. We’ll calculate
            required breaks, stops, and daily driver logs.
          </p>
        </div>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setValues(SAMPLE)
            setLocalErrors({})
          }}
          type="button"
        >
          Use sample trip
        </button>
      </div>

      <form className="trip-form" noValidate onSubmit={submit}>
        <div className="route-fields">
          <span aria-hidden="true" className="route-fields__line" />
          {FIELDS.map((field) => (
            <label className="field" key={field.name}>
              <span className="field__marker" aria-hidden="true">
                {field.marker}
              </span>
              <span className="field__content">
                <span className="field__label">{field.label}</span>
                <input
                  aria-invalid={Boolean(errors[field.name])}
                  disabled={busy}
                  maxLength={201}
                  name={field.name}
                  onChange={(event) => update(field.name, event.target.value)}
                  placeholder={field.placeholder}
                  type="text"
                  value={values[field.name]}
                />
                {errors[field.name] && (
                  <span className="field__error" role="alert">
                    {errors[field.name]}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>

        <label className="field field--cycle">
          <span className="cycle-icon" aria-hidden="true">
            70
          </span>
          <span className="field__content">
            <span className="field__label">Current cycle hours used</span>
            <span className="cycle-input">
              <input
                aria-invalid={Boolean(errors.cycle_hours_used)}
                disabled={busy}
                inputMode="decimal"
                max="70"
                min="0"
                name="cycle_hours_used"
                onChange={(event) =>
                  update("cycle_hours_used", event.target.value)
                }
                step="0.5"
                type="number"
                value={values.cycle_hours_used}
              />
              <span>of 70 hours</span>
            </span>
            {errors.cycle_hours_used && (
              <span className="field__error" role="alert">
                {errors.cycle_hours_used}
              </span>
            )}
          </span>
        </label>

        {error && (
          <div className="form-alert" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>We couldn’t plan this trip</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        <button className="primary-button primary-button--wide" disabled={busy}>
          {busy && <span className="button-spinner" aria-hidden="true" />}
          {busy ? loadingMessage : "Plan my trip"}
        </button>
      </form>
    </section>
  )
}

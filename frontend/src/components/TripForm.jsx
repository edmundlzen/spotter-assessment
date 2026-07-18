import { useEffect, useState } from "react"
import AltRouteOutlined from "@mui/icons-material/AltRouteOutlined"
import FlagOutlined from "@mui/icons-material/FlagOutlined"
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined"
import LocationOnOutlined from "@mui/icons-material/LocationOnOutlined"
import ScheduleOutlined from "@mui/icons-material/ScheduleOutlined"
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material"

const SEARCH_DELAY_MS = 350

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
    placeholder: "City, state, or street address",
    icon: LocationOnOutlined,
  },
  {
    name: "pickup_location",
    label: "Pickup location",
    placeholder: "City, state, or street address",
    icon: Inventory2Outlined,
  },
  {
    name: "dropoff_location",
    label: "Drop-off location",
    placeholder: "City, state, or street address",
    icon: FlagOutlined,
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

function LocationField({
  busy,
  error,
  field,
  onSearchLocations,
  onUpdate,
  value,
}) {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchUnavailable, setSearchUnavailable] = useState(false)
  const Icon = field.icon
  const query = value.trim()

  useEffect(() => {
    if (!onSearchLocations || query.length < 3) {
      setOptions([])
      setLoading(false)
      setSearched(false)
      setSearchUnavailable(false)
      return undefined
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setSearched(false)
      setSearchUnavailable(false)
      try {
        const results = await onSearchLocations(query, controller.signal)
        setOptions(results)
        setSearched(true)
      } catch (searchError) {
        if (searchError?.name !== "AbortError") {
          setOptions([])
          setSearchUnavailable(true)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, SEARCH_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [onSearchLocations, query])

  const guidance = searchUnavailable
    ? "Search is temporarily unavailable. You can still type the address."
    : "Start typing to search U.S. cities and addresses."

  return (
    <Autocomplete
      autoComplete
      disabled={busy}
      filterOptions={(available) => available}
      freeSolo
      getOptionKey={(option) =>
        `${option.label}-${option.coordinate.join(",")}`
      }
      getOptionLabel={(option) =>
        typeof option === "string" ? option : option.label
      }
      includeInputInList
      inputValue={value}
      loading={loading}
      loadingText="Searching locations…"
      noOptionsText={
        searched
          ? "No matches found. You can keep the address you typed."
          : "Type at least 3 characters to search."
      }
      onChange={(_, option) => {
        if (option) {
          onUpdate(
            field.name,
            typeof option === "string" ? option : option.label,
          )
        }
      }}
      onInputChange={(_, nextValue, reason) => {
        if (reason !== "reset") onUpdate(field.name, nextValue)
      }}
      options={options}
      sx={{ minWidth: 0, width: "100%" }}
      renderInput={(params) => (
        <TextField
          {...params}
          error={Boolean(error)}
          helperText={error ?? guidance}
          label={field.label}
          name={field.name}
          placeholder={field.placeholder}
          slotProps={{
            htmlInput: {
              ...params.slotProps.htmlInput,
              autoComplete: "off",
              maxLength: 201,
            },
            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {loading && (
                    <CircularProgress
                      aria-label={`Searching ${field.label.toLowerCase()}`}
                      color="inherit"
                      size={18}
                    />
                  )}
                  {params.slotProps.input.endAdornment}
                </>
              ),
              startAdornment: (
                <InputAdornment position="start">
                  <Icon color="action" fontSize="small" />
                </InputAdornment>
              ),
            },
            inputLabel: params.slotProps.inputLabel,
          }}
        />
      )}
      renderOption={(props, option) => (
        <Box component="li" {...props} key={`${option.label}-${option.coordinate}`}>
          <LocationOnOutlined
            color="action"
            fontSize="small"
            sx={{ flex: "0 0 auto", mr: 1.25 }}
          />
          <Typography component="span" variant="body2">
            {option.label}
          </Typography>
        </Box>
      )}
      selectOnFocus
    />
  )
}

export default function TripForm({
  busy,
  error,
  fieldErrors = {},
  initialValues = EMPTY,
  loadingMessage,
  onSearchLocations,
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
    <Card
      aria-labelledby="planner-title"
      component="section"
      elevation={3}
      sx={{ maxWidth: "100%", minWidth: 0, overflow: "hidden", width: "100%" }}
    >
      <CardHeader
        action={
          <Button
            disabled={busy}
            onClick={() => {
              setValues(SAMPLE)
              setLocalErrors({})
            }}
            size="small"
            sx={{ whiteSpace: "nowrap" }}
            type="button"
          >
            Use sample trip
          </Button>
        }
        subheader={
          <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            Enter the route and hours already used in the current 70-hour
            cycle.
          </Typography>
        }
        sx={{
          alignItems: { xs: "stretch", sm: "flex-start" },
          flexDirection: { xs: "column", sm: "row" },
          px: { xs: 2.5, sm: 4 },
          pb: 1,
          pt: { xs: 2.5, sm: 3.5 },
          "& .MuiCardHeader-action": {
            alignSelf: { xs: "flex-start", sm: "center" },
            ml: { xs: 0, sm: 2 },
            mt: { xs: 1, sm: 0 },
          },
          "& .MuiCardHeader-content": { width: "100%" },
        }}
        title={
          <Typography component="h1" id="planner-title" variant="h4">
            Plan a trip
          </Typography>
        }
      />

      <CardContent
        sx={{ minWidth: 0, px: { xs: 2.5, sm: 4 }, pb: { xs: 3, sm: 4 } }}
      >
        <Box
          component="form"
          noValidate
          onSubmit={submit}
          sx={{ minWidth: 0, width: "100%" }}
        >
          <Stack spacing={2.5} sx={{ minWidth: 0 }}>
            {FIELDS.map((field) => {
              return (
                <LocationField
                  busy={busy}
                  error={errors[field.name]}
                  field={field}
                  key={field.name}
                  onSearchLocations={onSearchLocations}
                  onUpdate={update}
                  value={values[field.name]}
                />
              )
            })}

            <TextField
              disabled={busy}
              error={Boolean(errors.cycle_hours_used)}
              helperText={
                errors.cycle_hours_used ??
                "Enter a value between 0 and 70 hours."
              }
              label="Current cycle hours used"
              name="cycle_hours_used"
              onChange={(event) =>
                update("cycle_hours_used", event.target.value)
              }
              slotProps={{
                htmlInput: {
                  inputMode: "decimal",
                  max: 70,
                  min: 0,
                  step: 0.5,
                },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">of 70 hours</InputAdornment>
                  ),
                  startAdornment: (
                    <InputAdornment position="start">
                      <ScheduleOutlined color="action" fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
              type="number"
              value={values.cycle_hours_used}
            />

            {error && (
              <Alert severity="error">
                <Typography fontWeight={700}>Couldn’t plan this trip</Typography>
                {error}
              </Alert>
            )}

            <Button
              disabled={busy}
              fullWidth
              size="large"
              startIcon={
                busy ? (
                  <CircularProgress color="inherit" size={18} />
                ) : (
                  <AltRouteOutlined />
                )
              }
              type="submit"
              variant="contained"
            >
              {busy ? loadingMessage : "Plan my trip"}
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  )
}

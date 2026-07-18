import { useState } from "react"
import AltRouteOutlined from "@mui/icons-material/AltRouteOutlined"
import FlagOutlined from "@mui/icons-material/FlagOutlined"
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined"
import LocationOnOutlined from "@mui/icons-material/LocationOnOutlined"
import ScheduleOutlined from "@mui/icons-material/ScheduleOutlined"
import {
  Alert,
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
    <Card
      aria-labelledby="planner-title"
      component="section"
      elevation={3}
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
          <Typography color="text.secondary">
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

      <CardContent sx={{ px: { xs: 2.5, sm: 4 }, pb: { xs: 3, sm: 4 } }}>
        <Box component="form" noValidate onSubmit={submit}>
          <Stack spacing={2.5}>
            {FIELDS.map((field) => {
              const Icon = field.icon
              return (
                <TextField
                  disabled={busy}
                  error={Boolean(errors[field.name])}
                  helperText={errors[field.name] ?? " "}
                  key={field.name}
                  label={field.label}
                  name={field.name}
                  onChange={(event) => update(field.name, event.target.value)}
                  placeholder={field.placeholder}
                  slotProps={{
                    htmlInput: { maxLength: 201 },
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <Icon color="action" fontSize="small" />
                        </InputAdornment>
                      ),
                    },
                  }}
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

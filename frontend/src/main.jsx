import { createRoot } from "react-dom/client"
import { CssBaseline, ThemeProvider } from "@mui/material"
import "@fontsource/roboto/latin-400.css"
import "@fontsource/roboto/latin-500.css"
import "@fontsource/roboto/latin-700.css"
import "leaflet/dist/leaflet.css"

import App from "./App.jsx"
import theme from "./theme.js"

createRoot(document.getElementById("root")).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <App />
  </ThemeProvider>,
)

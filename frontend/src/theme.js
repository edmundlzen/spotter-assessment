import { createTheme } from "@mui/material/styles"

const theme = createTheme({
  palette: {
    background: {
      default: "#f7f8fa",
      paper: "#ffffff",
    },
    divider: "#e4e7ec",
    primary: {
      main: "#155eef",
      dark: "#004eeb",
      light: "#eff4ff",
    },
    text: {
      primary: "#101828",
      secondary: "#475467",
    },
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h4: {
      fontSize: "1.75rem",
      fontWeight: 750,
      letterSpacing: "-0.025em",
    },
    h5: {
      fontWeight: 750,
      letterSpacing: "-0.02em",
    },
    h6: {
      fontWeight: 700,
      letterSpacing: "-0.012em",
    },
    button: {
      fontWeight: 650,
      letterSpacing: 0,
      textTransform: "none",
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        },
        "::selection": {
          backgroundColor: "#d1e0ff",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid #e4e7ec",
          borderRadius: 14,
          boxShadow:
            "0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px rgba(16, 24, 40, 0.06)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 40,
        },
        contained: {
          boxShadow: "0 1px 2px rgba(16, 24, 40, 0.08)",
          "&:hover": {
            boxShadow:
              "0 1px 2px rgba(16, 24, 40, 0.08), 0 4px 10px rgba(21, 94, 239, 0.18)",
          },
        },
        outlined: {
          borderColor: "#d0d5dd",
          "&:hover": {
            backgroundColor: "#f9fafb",
            borderColor: "#98a2b3",
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: "#ffffff",
          borderRadius: 10,
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "#98a2b3",
          },
          "&.Mui-focused": {
            boxShadow: "0 0 0 3px rgba(21, 94, 239, 0.12)",
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderWidth: 1,
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        fullWidth: true,
        size: "medium",
        variant: "outlined",
      },
    },
  },
})

export default theme

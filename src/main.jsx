import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import './styles.css'
import App from './App.jsx'
import Lineup from './scene/Lineup.jsx'
import { connect } from './net.js'
import { useOffice } from './store.js'

connect()
setInterval(() => useOffice.getState().tick(), 60_000)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {window.location.hash === '#lineup' ? <Lineup /> : <App />}
  </StrictMode>,
)

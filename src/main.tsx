import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import { ModelConfigProvider } from './contexts/ModelConfig'

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ModelConfigProvider>
      <App />
    </ModelConfigProvider>
  </ErrorBoundary>,
)

import { AuthProvider } from '../auth/AuthProvider'
import { ToastProvider } from '../components/toast/ToastProvider'
import { AuthGate } from './AuthGate'

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AuthGate />
      </ToastProvider>
    </AuthProvider>
  )
}

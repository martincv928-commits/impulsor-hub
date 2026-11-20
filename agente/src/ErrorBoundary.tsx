import { Component, type ReactNode } from 'react';
import Logo from './Logo';

/** Evita la pantalla en blanco si algo falla al dibujar: muestra un mensaje y deja reintentar. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error('ui error', e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (<div className="splash"><Logo size={56} /><p role="alert">Algo salió mal al mostrar esta pantalla.</p>
      <button onClick={() => { this.setState({ failed: false }); }}>Reintentar</button><button className="ghost" onClick={() => location.reload()}>Recargar la app</button></div>);
  }
}

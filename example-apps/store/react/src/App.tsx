import styles from './App.module.css';
import { Outlet } from 'react-router-dom';
import Navbar from './components/Navbar/Navbar';

export default function App() {
  return (
    <div className={styles.appContainer}>
      <Navbar />
      <div className={styles.routerOutletContainer}>
        <Outlet />
      </div>
    </div>
  );
}

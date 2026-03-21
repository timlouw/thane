import { useNavigate, useRouteError } from 'react-router-dom';
import styles from './NotFound.module.css';
import { RouteError } from '../../models/router.models';

interface NotFoundProps {
  propsError?: RouteError;
}

export default function NotFound({ propsError }: NotFoundProps) {
  const error = useRouteError() as RouteError;
  const navigate = useNavigate();
  const errorToRender = propsError ?? error;

  const returnHome = () => {
    navigate('/');
  };

  return (
    <div className={styles.errorPage}>
      <h1>Oops!</h1>
      <p>{errorToRender.statusText}</p>
      <p>{errorToRender.error?.message}</p>
      <button className={styles.returnHomeButton} onClick={returnHome}>
        Return Home
      </button>
    </div>
  );
}

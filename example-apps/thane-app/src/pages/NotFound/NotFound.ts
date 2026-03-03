import { defineComponent } from 'thane';
import styles from './NotFound.module.css';
import type { RouteError } from '../../models/router.models.js';
import { currentPath } from '../../state/global-state.js';

type NotFoundProps = {
  propsError?: RouteError;
};

export const NotFound = defineComponent<NotFoundProps>('not-found-page', ({ props }) => {
  const returnHome = () => {
    currentPath('/');
    navigate('/');
  };

  const errorToRender = props.propsError ?? {
    statusText: 'Oops!',
    error: {
      message: 'The page you requested does not exist.',
    },
  };

  return {
    template: html`
      <div class="errorPage">
        <h1>Oops!</h1>
        <p>${errorToRender.statusText ?? 'Not Found'}</p>
        <p>${errorToRender.error?.message ?? 'The page you requested does not exist.'}</p>
        <button class="returnHomeButton" @click=${returnHome}>Return Home</button>
      </div>
    `,
    styles,
  };
});

export default NotFound;

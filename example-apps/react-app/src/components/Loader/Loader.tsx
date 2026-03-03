import styles from './Loader.module.css';

interface LoaderProps {
  text: string;
}

export default function Loader({ text }: LoaderProps) {
  return (
    <div className={styles.loaderContainer}>
      <div className={styles.spinner}></div>
      <p>{text}</p>
    </div>
  );
}

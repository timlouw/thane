type HttpMethod = 'GET' | 'PUT' | 'POST';

const apiBaseURL = import.meta.env.REACT_APP_API_BASE_URL;

const sendRequest = <TRequest, TResponse>(method: HttpMethod, endpoint: string, body?: TRequest) => {
  return new Promise<TResponse>((resolve, reject: (reason?: unknown) => void) => {
    const options: RequestInit = {
      method: method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : null,
    };

    const combinedURL = `${apiBaseURL}${endpoint}`;

    fetch(combinedURL, options)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status.toString()}`);
        }
        res
          .json()
          .then((data: TResponse) => {
            resolve(data);
          })
          .catch((error: unknown) => {
            reject(new Error(error instanceof Error ? error.message : 'An unknown error occurred'));
          });
      })
      .catch((error: unknown) => {
        reject(new Error(error instanceof Error ? error.message : 'An unknown error occurred'));
      });
  });
};

export const GET = <TResponse>(endpoint: string) => sendRequest<never, TResponse>('GET', endpoint);

export const POST = <TRequest, TResponse>(endpoint: string, data: TRequest) =>
  sendRequest<TRequest, TResponse>('POST', endpoint, data);

export const PUT = <TRequest, TResponse>(endpoint: string, data: TRequest) =>
  sendRequest<TRequest, TResponse>('PUT', endpoint, data);

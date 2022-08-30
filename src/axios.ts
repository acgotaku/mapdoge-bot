import axios from 'axios';

const INTERNAL_SERVER_ERROR = 500;

const instance = axios.create();

instance.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
instance.defaults.headers.get['referer'] = 'https://plus.codes';

instance.interceptors.request.use(async config => {
  return config;
});

instance.interceptors.response.use(
  response => {
    return response.data;
  },
  async error => {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      if (error.response.status < INTERNAL_SERVER_ERROR) {
        if (error.response.data) {
          return Promise.reject(error.response.data);
        } else {
          // clientError
        }
      } else {
        // serverError
      }
    } else if (error.request) {
      // The request was made but no response was received
      // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
      // http.ClientRequest in node.js
    } else {
      // Something happened in setting up the request that triggered an Error
      // message = 'An error occurred while setting up an API request.';
      // requestError
    }
    return Promise.reject(error);
  }
);

export default instance;

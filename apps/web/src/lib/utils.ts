import { createCn } from 'cn/config';

/**
 * Class merger that knows our custom theme. Without this, `text-body` would be read as a
 * text color and silently remove `text-white` from the same element.
 * Keep in sync with the `--text-*` tokens in src/index.css.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['caption', 'small', 'body', 'body-lg', 'lead', 'h3', 'h2', 'h1', 'display'] },
      ],
    },
  },
});

import React from 'react';
import { useTranslation } from 'react-i18next';

const localizedAttributes = ['aria-label', 'title', 'placeholder'];

function localizeNode(node, t) {
  if (typeof node === 'string') return t(node, { ns: 'ui', defaultValue: node });
  if (Array.isArray(node)) return node.map((child) => localizeNode(child, t));
  if (!React.isValidElement(node)) return node;

  // Content supplied by rclone or the user is data, never interface copy.
  if (node.props['data-user-content'] !== undefined) return node;
  const props = { ...node.props };
  localizedAttributes.forEach((attribute) => {
    if (typeof props[attribute] === 'string') props[attribute] = t(props[attribute], { ns: 'ui', defaultValue: props[attribute] });
  });
  if (props.children !== undefined) props.children = localizeNode(props.children, t);
  return React.cloneElement(node, props);
}

export default function LocalizeTree({ children }) {
  const { t, i18n } = useTranslation('ui');
  React.useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);
  return localizeNode(children, t);
}

import React from 'react';
import { useTranslation } from 'react-i18next';

const localizedAttributes = ['aria-label', 'title', 'placeholder'];

function localizeText(value, t) {
  if (typeof value !== 'string') return value;
  const translated = t(value, { ns: 'ui', defaultValue: value });
  if (translated !== value) return translated;

  const patterns = [
    [/^Pannello (sorgente|destinazione)$/, (_, side) => `Panel ${side === 'sorgente' ? 'source' : 'destination'}`],
    [/^Aggiorna (.+)$/, (_, name) => `Refresh ${name}`],
    [/^Seleziona (.+)$/, (_, name) => `Select ${name}`],
    [/^Apri (.+)$/, (_, name) => `Open ${name}`],
    [/^Elimina (.+)$/, (_, name) => `Delete ${name}`],
    [/^Scarica (.+)$/, (_, name) => `Download ${name}`],
    [/^Copia (.+) verso (.+)$/, (_, name, destination) => `Copy ${name} to ${destination}`],
    [/^Sposta (.+) verso (.+)$/, (_, name, destination) => `Move ${name} to ${destination}`],
    [/^Copia verso (.+)$/, (_, destination) => `Copy to ${destination}`],
    [/^Sposta verso (.+)$/, (_, destination) => `Move to ${destination}`],
    [/^Cartella sorgente: (.+)$/, (_, path) => `Source folder: ${path}`],
    [/^Cartella destinazione: (.+)$/, (_, path) => `Destination folder: ${path}`],
    [/^Remote (.+)$/, (_, name) => `Remote ${name}`],
    [/^Seleziona (\d+) (elemento|elementi)$/, (_, count) => `Select ${count} items`],
    [/^Eliminazione avviata per (\d+) (elemento|elementi)\.$/, (_, count) => `Deletion started for ${count} items.`],
    [/^Job “(.+)” (eliminato|avviato)\.$/, (_, name, action) => `Job “${name}” ${action === 'eliminato' ? 'deleted' : 'started'}.`],
    [/^Job (creato|aggiornato)\.$/, (_, action) => `Job ${action === 'creato' ? 'created' : 'updated'}.`],
    [/^Remote salvato\.$/, () => 'Remote saved.'],
    [/^Download avviato\.$/, () => 'Download started.'],
    [/^Copia di (.+) avviato\.$/, (_, name) => `Copy of ${name} started.`],
    [/^Spostamento di (.+) avviato\.$/, (_, name) => `Move of ${name} started.`],
    [/^Bucket “(.+)” creato in (.+)\.$/, (_, name, remote) => `Bucket “${name}” created in ${remote}.`],
    [/^Configurazione salvata · (\d+) remote$/, (_, count) => `Settings saved · ${count} remotes`],
    [/^(\d+) (copie|spostamenti) avviati(?: · (\d+) non avviati)?\.$/, (_, count, kind, failed) => `${count} ${kind === 'copie' ? 'copies' : 'moves'} started${failed ? ` · ${failed} not started` : ''}.`],
    [/^(.+): completato\.$/, (_, label) => `${label}: completed.`],
    [/^Job: (.+)$/, (_, name) => `Job: ${name}`],
    [/^“(.+)” verrà rimosso insieme alla sua programmazione\. L’operazione non modifica i file nei remote\.$/, (_, name) => `“${name}” will be removed along with its schedule. This will not change files on either remote.`],
    [/^“(.+)” renderà la destinazione identica alla sorgente e può eliminare i file presenti solo in (.+)\.$/, (_, name, remote) => `“${name}” will make the destination match the source and may delete files that exist only in ${remote}.`],
    [/^Stai per eliminare (\d+) (elemento|elementi) da (.+)\. Controlla l’elenco prima di continuare\.$/, (_, count, noun, remote) => `You are about to delete ${count} ${Number(count) === 1 ? 'item' : 'items'} from ${remote}. Review the list before continuing.`],
    [/^Questa azione non si può annullare\. Verranno eliminati (\d+) (elemento|elementi) da (.+)\.$/, (_, count, noun, remote) => `This action cannot be undone. ${count} ${Number(count) === 1 ? 'item' : 'items'} will be deleted from ${remote}.`],
    [/^(\d+) file (pronto|pronti) per il download\.$/, (_, count) => `${count} ${Number(count) === 1 ? 'file is' : 'files are'} ready to download.`],
    [/^Eliminazione avviata per (\d+) (elemento|elementi)\.$/, (_, count) => `Deletion started for ${count} ${Number(count) === 1 ? 'item' : 'items'}.`],
    [/^Seleziona (\d+) (elemento|elementi) da (.+)$/, (_, count, noun, remote) => `Select ${count} ${noun === 'elemento' ? 'item' : 'items'} from ${remote}`],
    [/^(.+) è vuoto$/, (_, name) => `${name} is empty`],
  ];
  const matched = patterns.find(([pattern]) => pattern.test(value));
  return matched ? value.replace(matched[0], matched[1]) : value;
}

function localizeNode(node, t) {
  if (typeof node === 'string') return localizeText(node, t);
  if (Array.isArray(node)) return node.map((child) => localizeNode(child, t));
  if (!React.isValidElement(node)) return node;

  const props = { ...node.props };
  localizedAttributes.forEach((attribute) => {
    if (typeof props[attribute] === 'string') props[attribute] = localizeText(props[attribute], t);
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

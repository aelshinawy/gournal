import { openJournal } from '../../src/storage/journal';

const journal = openJournal();
journal.close();

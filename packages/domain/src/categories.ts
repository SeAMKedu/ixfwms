import type { AttributeField } from './attributes.js';

/* Categories and the fields they define. */

export interface CategoryInfo {
  path: string;
  /** Parts in this category and every category below it. */
  parts: number;
  /** Parts in this category itself. */
  ownParts: number;
  /** Number of the category's own fields. */
  fields: number;
}

export interface CategoryFields {
  path: string;
  own: AttributeField[];
  /** Own fields plus those inherited from parent categories. */
  effective: AttributeField[];
}

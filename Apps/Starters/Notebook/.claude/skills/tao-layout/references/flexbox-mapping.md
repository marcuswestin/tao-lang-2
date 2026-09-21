# Tao Layout to React Native Flexbox

The runtime resolves clauses in source order after merging defaults, design bundles, and direct
clauses. Later entries replace only the same semantic slot.

| Tao clause                                | React Native result                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `content top`                             | Main-axis `justifyContent: flex-start` in a `Col`; cross-axis `alignItems: flex-start` in a `Row`.           |
| `content bottom`                          | Main-axis `justifyContent: flex-end` in a `Col`; cross-axis `alignItems: flex-end` in a `Row`.               |
| `content left`                            | Main-axis `justifyContent: flex-start` in a `Row`; cross-axis `alignItems: flex-start` in a `Col`.           |
| `content right`                           | Main-axis `justifyContent: flex-end` in a `Row`; cross-axis `alignItems: flex-end` in a `Col`.               |
| `content center`                          | Fills unassigned axes with `center`; alone sets both `justifyContent` and `alignItems` to `center`.          |
| `content baseline`                        | Cross-axis `alignItems: baseline`.                                                                           |
| `content stretch`                         | Cross-axis `alignItems: stretch`.                                                                            |
| `content spread`                          | Main-axis `justifyContent: space-between`.                                                                   |
| `content spread-inset`                    | Main-axis `justifyContent: space-around`.                                                                    |
| `content spread-balanced`                 | Main-axis `justifyContent: space-evenly`.                                                                    |
| `fill`                                    | `flexGrow: 1` plus `alignSelf: stretch`.                                                                     |
| `claim N`                                 | `flexGrow: N`; replaces the growth part of `fill` or `hug`.                                                  |
| `hug`                                     | `flexGrow: 0`; replaces `claim` or the growth part of `fill`.                                                |
| `compress`                                | `flexShrink: 1`; replaces `rigid`.                                                                           |
| `rigid`                                   | `flexShrink: 0`; replaces `compress`.                                                                        |
| `width N`, `height N`                     | Numeric `width` or `height`. A physical size replaces the corresponding effect of an earlier bare `fill`.    |
| `width fill`                              | `flexGrow: 1` under a row parent; otherwise `alignSelf: stretch`.                                            |
| `height fill`                             | `flexGrow: 1` under a column parent; otherwise `alignSelf: stretch`.                                         |
| `width max N`                             | `maxWidth: N`; also `width: 100%` when the parent is not a row, so a centered readable column remains fluid. |
| `aligned top                              | left`                                                                                                        | `alignSelf: flex-start`. |
| `aligned bottom                           | right`                                                                                                       | `alignSelf: flex-end`. |
| `aligned center`, `centered`              | `alignSelf: center`.                                                                                         |
| `aligned baseline`                        | `alignSelf: baseline`.                                                                                       |
| `gap N`                                   | `gap: N`.                                                                                                    |
| `pad N`, `margin N`                       | `padding: N` or `margin: N`.                                                                                 |
| `pad horizontal N`, `margin horizontal N` | Matching left and right properties.                                                                          |
| `pad vertical N`, `margin vertical N`     | Matching top and bottom properties.                                                                          |
| `pad                                      | margin top                                                                                                   | right | bottom | left N` | Matching physical side property; later side entries replace only those sides. |

Container defaults:

| View          | Defaults before caller clauses                                          |
| ------------- | ----------------------------------------------------------------------- |
| `Col`         | Column, `content top stretch`, `fill`.                                  |
| `Row`         | Row, `content baseline left`, `fill`.                                   |
| `Stack`       | Column, `content top center`, `hug`.                                    |
| `Box`         | Row, `content left center`, `hug`.                                      |
| `WrappingRow` | Row, `content baseline left`, `compress`, `hug`, plus `flexWrap: wrap`. |

Bare `fill` replaces earlier `aligned`/`centered`, `claim`/`hug`, and physical dimensions, except
that `width max N` remains as a cap. A later alignment or growth clause can replace one half of
`fill` without erasing the other half.

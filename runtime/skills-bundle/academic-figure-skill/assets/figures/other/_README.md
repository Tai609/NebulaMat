# Other Figure Types (Long-Tail Assets)

Place production scripts for figure types that do NOT yet have a dedicated sub-skill. These are used by the Hub's long-tail handler for pattern-level reference.

Organize by figure type with clear file naming:

```
other/
├── manhattan_gwas.R
├── manhattan_gwas.png
├── umap_cell_types.py
├── umap_cell_types.png
├── sankey_pathway.py
├── circos_genome.R
├── survival_km.R
├── venn_upset.R
├── phylogenetic_tree.R
├── network_interactome.py
├── gsea_bubble.R
├── protein_domain.py
└── ...
```

## When to Promote to Sub-Skill

When a figure type in this directory accumulates 5+ request patterns and 3+ production scripts, consider:
1. Creating a dedicated sub-skill directory at the project root
2. Moving the scripts from `other/` to the new sub-skill's `assets/figures/` directory
3. Adding the six-section SKILL.md with domain expertise

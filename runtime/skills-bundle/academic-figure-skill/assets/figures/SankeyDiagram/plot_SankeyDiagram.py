import os, numpy as np, pandas as pd
from sankeyplot import sankey

os.makedirs("./result/paper_figures", exist_ok=True)

# ═══════════════════════════════════════════════════════════
# 1. Node definitions 
# ═══════════════════════════════════════════════════════════

INPUTS  = ["Amplification", "Mutation", "Deletion"]

H1 = ["AR", "TP53", "PTEN", "RB1", "MDM4",
      "FGFR1", "MAML3", "PDGFA", "NOTCH1", "EIF3E", "Residual"]

H2 = ["Ub-specific proc. proteases", "HSP90 SHR",
      "Neutrophil degranulation", "PKN1 and AR transcription",
      "SUMOylation", "NR transcription pathway",
      "Antigen processing", "RUNX2 and bone",
      "Regulation of TP53 Activity", "TP53 metabolic regulation",
      "Residual"]

H3 = ["SUMO E3 ligases", "TP53 transc. regulation",
      "RUNX2 transc. regulation", "G2/M transition",
      "RHO GTPases activate PKNs", "PTEN regulation",
      "Mitotic prophase", "Mitotic metaphase-anaphase",
      "Mitotic prometaphase", "Cap-dependent translation",
      "Residual"]

H4 = ["Generic transc. pathway", "Deubiquitination",
      "SUMOylation", "Rho GTPase effectors",
      "M phase", "Class I MHC pathway",
      "PIP3 activates AKT signalling", "Mitotic G2-G2/M phases",
      "Cellular senescence", "Eukaryotic translation",
      "Residual"]

H5 = ["Post-transl. modification", "RNA Pol II transc.",
      "Cellular responses to stress", "Cell cycle, mitotic",
      "Adaptive immune system", "Innate immune system",
      "Signalling by Rho GTPases", "Intracellular signalling",
      "Translation", "Immune cytokine sig.",
      "Residual"]

H6 = ["Metabolism of proteins", "Transcription (general)",
      "Immune system", "Signal transduction",
      "External stimuli response", "Cell cycle"]

OUTCOME = ["Outcome"]

# ═══════════════════════════════════════════════════════════
# 2. Sampling probabilities 
# ═══════════════════════════════════════════════════════════

PROBS = {
    "Inputs":  [0.50, 0.30, 0.20],
    "H1":      [0.14, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02, 0.02, 0.38],
    "H2":      [0.10, 0.08, 0.08, 0.06, 0.06, 0.06, 0.04, 0.04, 0.04, 0.04, 0.40],
    "H3":      [0.12, 0.09, 0.08, 0.07, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.28],
    "H4":      [0.12, 0.09, 0.08, 0.07, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.28],
    "H5":      [0.12, 0.14, 0.10, 0.10, 0.10, 0.10, 0.10, 0.05, 0.05, 0.06, 0.08],
    "H6":      [0.20, 0.20, 0.20, 0.15, 0.15, 0.10],
    "Outcome": [0.5],
}

ALL_NODES = {
    "Inputs":  INPUTS,
    "H1":      H1,
    "H2":      H2,
    "H3":      H3,
    "H4":      H4,
    "H5":      H5,
    "H6":      H6,
    "Outcome": OUTCOME,
}

# ═══════════════════════════════════════════════════════════
# 3. Simulate data 
# ═══════════════════════════════════════════════════════════

def simulate_r_style(n: int = 100, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    data = {}
    for layer in ["Inputs", "H1", "H2", "H3", "H4", "H5", "H6", "Outcome"]:
        nodes = ALL_NODES[layer]
        probs = np.array(PROBS[layer])
        probs = probs / probs.sum()
        data[layer] = rng.choice(nodes, size=n, p=probs)
    return pd.DataFrame(data)


df = simulate_r_style(n=100, seed=42)
print(f"Simulated: {len(df)} rows x {len(df.columns)} columns")
for col in df.columns:
    counts = df[col].value_counts()
    print(f"  {col}: {dict(counts)}")

# ═══════════════════════════════════════════════════════════
# 4. 自主开发的sankey绘图包
# ═══════════════════════════════════════════════════════════

nature_custom = {
    "main_palette":      ["#7B1515", "#B54848", "#D4956A", "#8BBDD4", "#4A6FAF", "#C4A35A"],
    "gradient_method":   "sequential",
    "gradient_lighten":  0.6,
    "input_colors":      ["#D4956A", "#8BBDD4", "#4A6FAF"],
    "residual_color":    "#F0F0F0",
    "residual_link_alpha": 0.38,
    "outcome_color":     "#5A1010",
    "outcome_link_alpha": 0.35,
    "default_link_alpha": 0.18,
    "font_family":       "Arial",
    "font_size":         18,
    "node_thickness":    25,
    "node_pad":          80,
}

layer_cols = ["Inputs", "H1", "H2", "H3", "H4", "H5", "H6", "Outcome"]

fig = sankey(
    df,
    layer_cols=layer_cols,
    preset=nature_custom,
    y_method="fixed_gap",
    gap=0.012,
    height=750,
    width=2200,
)

# 输出路径
base_path = "./result/paper_figures/sankey_nature"
out_html  = f"{base_path}.html"
out_png   = f"{base_path}.png"
out_pdf   = f"{base_path}.pdf"

# 1. 保存交互式 HTML
fig.write_html(out_html)
print(f"\nSaved HTML: {out_html}")

# 2. 保存 PNG（scale 提高分辨率，论文推荐 scale=2~3）
fig.write_image(out_png, width=1800, height=800, scale=2)
print(f"Saved PNG: {out_png}")

# 3. 保存 PDF（矢量图，期刊/论文首选，无损缩放）
fig.write_image(out_pdf, width=1800, height=800)
print(f"Saved PDF: {out_pdf}")
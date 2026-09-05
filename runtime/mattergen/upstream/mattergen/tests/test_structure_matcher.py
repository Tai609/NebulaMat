from typing import List, Tuple

import pytest
from pymatgen.core import Element, Structure

from mattergen.evaluation.utils.structure_matcher import (
    DefaultDisorderedStructureMatcher,
    DefaultOrderedStructureMatcher,
    check_is_disordered,
)


@pytest.fixture
def test_structures_for_matcher() -> List[Structure]:
    lattice = [[6, 0, 0], [0, 6, 0], [0, 0, 6]]
    coords = [[0, 0, 0], [0.5, 0.5, 0.5], [0.4, 0.6, 0.2], [0, 0, 0.75]]
    structures = [
        Structure(
            lattice=lattice,
            species=["O2-", "O2-", "Be2+", "Po2+"],
            coords=coords,
        ),
        Structure(
            lattice=lattice,
            species=["O2-", "O2-", "Sr2+", "Ba2+"],
            coords=coords,
        ),
        Structure(
            lattice=lattice,
            species=["Zn", "Zn", "Cl", "Cl"],
            coords=coords,
        ),
        Structure(
            lattice=lattice,
            species=["Fe", "Fe", "Ni", "Mn"],
            coords=coords,
        ),
        Structure(
            lattice=lattice,
            species=["Ni", "Fe", "Mn", "Fe"],
            coords=coords,
        ),
        Structure(
            lattice=lattice,
            species=["Fe", "Ni", "Ni", "Mn"],
            coords=coords,
        ),
        Structure(
            lattice=lattice,
            species=["O2-", "O2-", "Ba2+", "Sr2+"],
            coords=coords,
        ),
        Structure(
            lattice=lattice,
            species=["O2-", "O2-", "Ba2+", "Sr2+"],
            coords=[[0, 0, 0], [0.75, 0.2, 0.1], [0.25, 0.3, 0.5], [0, 0, 0.75]],
        ),
        Structure(
            lattice=lattice,
            species=["Fe", "Fe", "Ni", "Mn"],
            coords=[[0, 0, 0], [0.3, 0.2, 0.1], [0.23, 0.3, 0.3], [0, 0, 0.3]],
        ),
        Structure(
            lattice=lattice,
            species=["O2-", "O2-", "Ba2+", "Sr2+"],
            coords=coords,
        ).replace_species({"Ba2+": "Ba0.5Sr0.5", "Sr2+": "Ba0.5Sr0.5"}),
        Structure(
            lattice=lattice,
            species=["O2-", "O2-", "Ba2+", "Sr2+"],
            coords=coords,
        ).replace_species({"Ba2+": "Ba0.1Sr0.9", "Sr2+": "Ba0.1Sr0.9"}),
        Structure(
            lattice=lattice,
            species=["Fe", "Fe", "Ni", "Mn"],
            coords=coords,
        ).replace_species(
            {"Fe": "Fe0.5Ni0.25Mn0.25", "Ni": "Fe0.5Ni0.25Mn0.25", "Mn": "Fe0.5Ni0.25Mn0.25"}
        ),
    ]

    return structures


@pytest.mark.parametrize(
    "index, expected_is_disordered, expected_substitutional_groups",
    [
        (0, False, [[]]),
        (1, True, [[Element("Ba"), Element("Sr")]]),
        (2, False, [[]]),
        (3, True, [[Element("Mn"), Element("Fe"), Element("Ni")]]),
    ],
)
def test_disordered_checker(
    test_structures_for_matcher,
    index: int,
    expected_is_disordered: bool,
    expected_substitutional_groups: list[list[Element]],
):
    structures = test_structures_for_matcher

    is_disordered, substitutional_groups = check_is_disordered(
        structure=structures[index],
        relative_radius_difference_threshold=0.3,
        electronegativity_difference_threshold=1.0,
    )
    assert is_disordered == expected_is_disordered
    assert substitutional_groups == expected_substitutional_groups


@pytest.mark.parametrize(
    "indices, expected_match",
    [
        ([0, 0], True),  # Identical structures
        ([0, 1], False),  # Different cations
        ([3, 4], True),  # Metal alloys same formula
        ([3, 5], False),  # Metal alloys different formula, strict formula enforcement
        ([1, 6], True),  # Ionic same cations different positions but equivalent
        ([1, 7], False),  # Ionic, Same species different positions
        ([3, 8], False),  # Metal, Same species different positions
        ([1, 9], True),  # Ionic, same system but one is disordered
        ([1, 10], False),  # Ionic, different stechiometry and one is disordered
        ([9, 10], False),  # Ionic, different stechiometry and both are disordered
        ([3, 11], True),  # Metallic, ordered vs disordered
        ([4, 11], True),  # Ionic, ordered vs disordered
    ],
)
def test_structure_comparison(
    test_structures_for_matcher,
    indices: Tuple[int, int],
    expected_match: bool,
):
    structures = test_structures_for_matcher
    id_1, id_2 = indices
    disordered_structure_matcher = DefaultDisorderedStructureMatcher()
    assert disordered_structure_matcher.fit(structures[id_1], structures[id_2]) == expected_match


def test_structure_matcher_ignores_formal_space_group():
    structure_1 = Structure(
        lattice=[[6, 0, 0], [0, 6, 0], [0, 0, 6]],
        species=["Cr4+", "F-", "F-", "F-", "F-"],
        coords=[[0, 0, 0], [0.5, 0.3, 0.3], [0.5, 0.3, 0.7], [0.5, 0.7, 0.3], [0.5, 0.7, 0.7]],
    )
    structure_2 = Structure(
        lattice=[[6, 0, 0], [0, 6, 0], [0, 0, 6]],
        species=["Cr4+", "F-", "F-", "F-", "F-"],
        coords=[[0, 0, 0], [0.5, 0.2, 0.3], [0.5, 0.2, 0.7], [0.5, 0.8, 0.3], [0.5, 0.8, 0.7]],
    )

    # The two structures are almost identical, but they have different space groups
    assert structure_1.get_space_group_info(symprec=0.1) != structure_2.get_space_group_info(
        symprec=0.1
    )

    assert DefaultOrderedStructureMatcher().fit(structure_1, structure_2)
    assert DefaultDisorderedStructureMatcher().fit(structure_1, structure_2)

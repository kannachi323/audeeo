# cmake/setup_assets

function(setup_assets target_name)
    set(RES_DEST ${CMAKE_RUNTIME_OUTPUT_DIRECTORY})
    
    add_custom_command(
        TARGET ${target_name} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/src/gui ${RES_DEST}
        COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/libs ${RES_DEST}
        COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/fonts ${RES_DEST}/fonts
        COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/assets ${RES_DEST}/assets
        COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/config ${RES_DEST}/config
        COMMENT "Copying resource directories to build folder..."
    )


endfunction()